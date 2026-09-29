# Stencil MVP demo evidence

## Presentation screen

Open `/#/status` in the web frontend. The page is available before login and from
the **System status** sidebar item after login.

The page provides:

- live frontend and exam API availability;
- scanner, database, AI provider, and storage probes;
- the current demo-mode state;
- the seven-step examiner demonstration sequence;
- counts derived from local uploads and saved demo evaluations;
- **Export JSON** for an evidence snapshot;
- **Print / PDF** for an exportable presentation page.

The API evidence is also available at `GET /demo/report` while
`STENCIL_DEMO_MODE=true`. General service readiness is available at
`GET /status`.

## Demo sequence

1. Open **DEMO MODE** and select the seeded examination and student.
2. Capture or upload an answer-sheet image.
3. Run quality validation and show either the pass state or an explainable warning.
4. Upload the accepted image and run answer analysis.
5. Show question association, the explicitly labelled AI/demo suggestion, and its reason.
6. Override a question mark, optionally record a reason, and save the validated total.
7. Return to the dashboard and show the updated completed/pending counts and review flags.

## Measurement boundaries

- Test pages and successful captures count files stored by the local demo upload path.
- Question matching counts populated associations in saved evaluation records.
- Validation warnings count warnings persisted with saved evaluations.
- Saved evaluations count current demo evaluation records.
- Rejected browser selections are not persisted, so rejected images are reported as
  **not measured**.
- Ground-truth matching accuracy, latency, throughput, and model accuracy are not measured.
- Seeded demo records are labelled demo evidence and are not production results.

The health page probes the scanner service but does not start it or access a camera.
