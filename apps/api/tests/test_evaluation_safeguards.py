import unittest

import cv2
import numpy as np

from apps.api.app.main import (
    AnswerEvaluationItem,
    _build_dashboard,
    _build_demo_report,
    analyze_image_quality,
    validate_evaluations,
)


RUBRIC = [
    {"q_no": "1", "marks": 5},
    {"q_no": "2", "marks": 10},
]


def evaluation(q_no: str, final_marks: float, *, unchecked: bool = False) -> AnswerEvaluationItem:
    return AnswerEvaluationItem(
        q_no=q_no,
        max_marks=5 if q_no == "1" else 10,
        suggested_marks=final_marks,
        final_marks=final_marks,
        unchecked=unchecked,
    )


class EvaluationSafeguardTests(unittest.TestCase):
    def test_valid_evaluation(self):
        total, issues = validate_evaluations(
            [evaluation("1", 4), evaluation("2", 8)], RUBRIC, 12
        )
        self.assertEqual(total, 12)
        self.assertFalse([item for item in issues if item["severity"] == "error"])

    def test_invalid_duplicate_missing_and_total(self):
        total, issues = validate_evaluations(
            [evaluation("1", 3), evaluation("1", 2)], RUBRIC, 10
        )
        codes = {item["code"] for item in issues}
        self.assertEqual(total, 3)
        self.assertTrue(
            {"DUPLICATE_QUESTION_ASSOCIATION", "MISSING_EXPECTED_QUESTION", "TOTAL_MISMATCH"}.issubset(codes)
        )

    def test_unanswered_question_is_detected(self):
        total, issues = validate_evaluations(
            [evaluation("1", 0, unchecked=True), evaluation("2", 7)], RUBRIC, 7
        )
        self.assertEqual(total, 7)
        self.assertIn("UNANSWERED_QUESTION", {item["code"] for item in issues})
        self.assertNotIn("UNANSWERED_WITH_MARKS", {item["code"] for item in issues})

    def test_over_marked_and_negative_are_rejected(self):
        _, issues = validate_evaluations(
            [evaluation("1", -1), evaluation("2", 11)], RUBRIC, 10
        )
        codes = {item["code"] for item in issues}
        self.assertIn("NEGATIVE_MARKS", codes)
        self.assertIn("MARKS_ABOVE_MAXIMUM", codes)


class ImageQualitySafeguardTests(unittest.TestCase):
    @staticmethod
    def encode(image: np.ndarray) -> bytes:
        success, encoded = cv2.imencode(".jpg", image)
        if not success:
            raise AssertionError("test image encoding failed")
        return encoded.tobytes()

    @staticmethod
    def clear_document() -> np.ndarray:
        image = np.full((1200, 900, 3), 255, np.uint8)
        for y in range(120, 1080, 70):
            cv2.putText(
                image,
                "Answer text 123",
                (100, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 0, 0),
                2,
                cv2.LINE_AA,
            )
        return image

    def test_clear_document_passes(self):
        result = analyze_image_quality(self.encode(self.clear_document()))
        self.assertTrue(result["passed"])

    def test_blurry_low_contrast_and_cropped_images_are_flagged(self):
        clear = self.clear_document()
        blurry = cv2.GaussianBlur(clear, (51, 51), 0)
        low_contrast = np.full((1200, 900, 3), 225, np.uint8)
        cv2.putText(low_contrast, "faint", (100, 400), cv2.FONT_HERSHEY_SIMPLEX, 2, (210, 210, 210), 2)
        cropped = clear.copy()
        cv2.rectangle(cropped, (0, 0), (899, 1199), (0, 0, 0), 35)

        blurry_codes = {item["code"] for item in analyze_image_quality(self.encode(blurry))["warnings"]}
        contrast_codes = {item["code"] for item in analyze_image_quality(self.encode(low_contrast))["warnings"]}
        cropped_codes = {item["code"] for item in analyze_image_quality(self.encode(cropped))["warnings"]}

        self.assertIn("BLURRY_IMAGE", blurry_codes)
        self.assertIn("VERY_LOW_CONTRAST", contrast_codes)
        self.assertIn("CROPPED_OR_INCOMPLETE_PAGE", cropped_codes)


class DashboardAnomalyRuleTests(unittest.TestCase):
    @staticmethod
    def row(index: int, awarded: float, suggested: float, final: float) -> dict:
        return {
            "final_exam_id": 1,
            "student_index": index,
            "student_name": f"Student {index + 1}",
            "subject_name": "Test exam",
            "awarded_marks": awarded,
            "max_marks": 10,
            "updated_by": "Examiner A",
            "moderation_status": "pending",
            "evaluations_json": [
                {
                    "q_no": "1",
                    "max_marks": 10,
                    "suggested_marks": suggested,
                    "final_marks": final,
                    "override_reason": "Human review",
                    "unchecked": False,
                    "flags": [],
                }
            ],
        }

    def test_high_score_and_large_ai_difference_route_for_review(self):
        dashboard = _build_dashboard([self.row(0, 10, 4, 10)], {"Examiner A": 2})
        codes = set(dashboard["moderation"][0]["warning_types"])
        self.assertIn("UNUSUALLY_HIGH_SCORE", codes)
        self.assertIn("LARGE_AI_EXAMINER_DIFFERENCE", codes)
        self.assertEqual(dashboard["summary"]["scripts_needing_review"], 1)
        self.assertIn("human review only", dashboard["notice"])

    def test_repeated_zero_rule_requires_three_scripts(self):
        rows = [self.row(index, 0, 0, 0) for index in range(3)]
        dashboard = _build_dashboard(rows, {"Examiner A": 3})
        self.assertTrue(
            all("REPEATED_ZERO_MARKS" in row["warning_types"] for row in dashboard["moderation"])
        )

    def test_low_score_and_high_override_count_are_flagged(self):
        row = self.row(0, 1, 1, 1)
        row["evaluations_json"] = [
            {"q_no": str(index), "suggested_marks": 0, "final_marks": 0.25, "unchecked": False, "flags": []}
            for index in range(1, 5)
        ]
        dashboard = _build_dashboard([row], {"Examiner A": 1})
        codes = set(dashboard["moderation"][0]["warning_types"])
        self.assertIn("UNUSUALLY_LOW_SCORE", codes)
        self.assertIn("HIGH_OVERRIDE_COUNT", codes)

    def test_repeated_full_marks_rule_requires_three_scripts(self):
        rows = [self.row(index, 10, 10, 10) for index in range(3)]
        dashboard = _build_dashboard(rows, {"Examiner A": 3})
        self.assertTrue(
            all("REPEATED_FULL_MARKS" in row["warning_types"] for row in dashboard["moderation"])
        )

    def test_resolved_warning_is_not_counted_as_needing_review(self):
        row = self.row(0, 10, 4, 10)
        row["moderation_status"] = "resolved"
        dashboard = _build_dashboard([row], {"Examiner A": 1})
        self.assertEqual(dashboard["summary"]["scripts_needing_review"], 0)


class DemoReportTests(unittest.TestCase):
    def test_report_uses_observed_counts_and_marks_unmeasured_values(self):
        report = _build_demo_report()
        self.assertEqual(report["metrics"]["rejected_images"]["display"], "not measured")
        self.assertGreaterEqual(report["metrics"]["saved_evaluations"]["value"], 2)
        self.assertIn("Ground-truth matching accuracy is not measured", report["metrics"]["question_matching"]["note"])
        self.assertEqual(
            [step["key"] for step in report["sequence"]],
            ["upload", "quality", "matching", "suggestion", "override", "save", "dashboard"],
        )


if __name__ == "__main__":
    unittest.main()
