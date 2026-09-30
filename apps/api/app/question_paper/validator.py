"""Deterministic validation engine (spec section 17) — never trust AI blindly."""

from __future__ import annotations

from .schemas import CanonicalExam, CanonicalQuestion, ValidationResult


def _q_marks(q: CanonicalQuestion) -> float:
    if q.selection_rule and q.selection_rule.type == "choose_n" and q.marks_per_item:
        try:
            return float(q.selection_rule.count) * float(q.marks_per_item)
        except (TypeError, ValueError):
            pass
    if q.total_marks is not None:
        try:
            return float(q.total_marks)
        except (TypeError, ValueError):
            pass
    if q.marks is not None:
        try:
            return float(q.marks)
        except (TypeError, ValueError):
            pass
    # fall back: sum of subquestions / alternatives
    if q.subquestions:
        return sum(float(s.marks or 0) for s in q.subquestions)
    if q.alternatives:
        vals = [float(a.marks or 0) for a in q.alternatives]
        return max(vals) if vals else 0.0
    return 0.0


def validate_exam(exam: CanonicalExam) -> ValidationResult:
    issues: list[str] = []
    total = round(sum(_q_marks(q) for q in exam.questions), 2)
    count = len(exam.questions)

    declared_marks = exam.exam.maximum_marks or 0
    marks_match = (abs(total - declared_marks) < 1e-6) if declared_marks else True
    if declared_marks and not marks_match:
        issues.append(f"marks total {total:g} != declared maximum {declared_marks:g}")

    declared_n = exam.exam.declared_question_count
    count_match = (count == declared_n) if declared_n else True
    if declared_n is not None and not count_match:
        issues.append(f"question count {count} != declared {declared_n}")

    seen: dict[str, int] = {}
    for q in exam.questions:
        seen[q.question_number] = seen.get(q.question_number, 0) + 1
        if not q.question_text.strip() and not q.subquestions and not q.alternatives:
            issues.append(f"Q{q.question_number}: missing question text")
        if q.marks is None and q.total_marks is None and not q.subquestions and not q.alternatives:
            issues.append(f"Q{q.question_number}: no marks recorded")
        for r in q.source.regions:
            if not (isinstance(r.bbox, list) and len(r.bbox) == 4):
                issues.append(f"Q{q.question_number}: invalid bounding box")
            if r.page not in q.source.pages:
                issues.append(f"Q{q.question_number}: region page {r.page} not in source pages")
        # OR alternatives must carry marks
        if q.selection_rule and q.selection_rule.type == "choose_one" and q.alternatives:
            if any(a.marks is None for a in q.alternatives):
                issues.append(f"Q{q.question_number}: OR alternative missing marks")
        # attempt-any-N check: 5 x 2 = 10 computed in Python, not by AI
        if q.selection_rule and q.selection_rule.type == "choose_n":
            if q.marks_per_item is not None and q.total_marks is not None:
                try:
                    expect = float(q.selection_rule.count) * float(q.marks_per_item)
                    if abs(expect - float(q.total_marks)) > 1e-6:
                        issues.append(
                            f"Q{q.question_number}: {q.selection_rule.count} x "
                            f"{q.marks_per_item:g} != {q.total_marks:g}"
                        )
                except (TypeError, ValueError):
                    pass
        # subquestion marks vs parent
        if q.subquestions and q.marks is not None:
            try:
                ssum = sum(float(s.marks or 0) for s in q.subquestions)
                if ssum and abs(ssum - float(q.marks)) > 1e-6:
                    issues.append(f"Q{q.question_number}: subquestion marks sum {ssum:g} != parent {float(q.marks):g}")
            except (TypeError, ValueError):
                pass
    for qn, n in seen.items():
        if n > 1:
            issues.append(f"duplicate question number: {qn}")
    # missing numbers in 1..N sequence
    try:
        nums = sorted(int(qn) for qn in seen if str(qn).isdigit())
        if nums:
            for expect in range(nums[0], nums[-1] + 1):
                if expect not in nums:
                    issues.append(f"missing question number: {expect}")
    except ValueError:
        pass

    return ValidationResult(
        marks_total=total, question_count=count,
        marks_match=marks_match, question_count_match=count_match,
        issues=issues,
    )
