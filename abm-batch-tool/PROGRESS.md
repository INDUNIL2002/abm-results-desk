# ABM Results Desk progress

Saved on 20 October 2026 at the user's request to stop work and conserve credits.

## Purpose and current scope

The user wants a reusable web tool for the entire University of Ruhuna Agribusiness Management batch. Students enter their own results, calculate semester and current cumulative GPA, and prepare a student-created results summary for internal departmental selection.

This is not a university-issued transcript and is not an external university admissions submission service.

## What is saved

Project folder: `C:\Users\Asus\Desktop\LinkedIn\abm-batch-tool`

The implemented buildless website is in `dist/`:

- `index.html`: interface, profile, semester navigation, course editor, summary dialog.
- `style.css`: desktop and mobile layouts, report preview, A4 printing.
- `app.mjs`: grade entry, electives/custom courses, corrections, repeat confirmation, calculated summaries, JSON save/open, CSV export, print/save PDF, optional local device saving, clean tool-link sharing.
- `gpa.mjs`: pure calculation and validation engine.
- `curriculum.json`: course catalogue.
- `favicon.svg`: app icon.

Other source files:

- `data/curriculum.json`: original catalogue transcription and source notes.
- `tests/gpa.test.mjs`: 18 calculation tests.
- `serve.mjs`: local preview server at `http://127.0.0.1:4173`.
- `README.md`: usage, source limitations and development notes.
- `.openai/hosting.json`: persisted Site identity.

No real student grades or personal student data have been entered into the app or committed. Student input stays in the browser. JSON/CSV downloads and browser printing are local.

## Source and GPA rules

Source: four screenshots supplied by the user, Faculty of Agriculture, University of Ruhuna Student Handbook 2021/22, pp. 30–36.

- 59 catalogue rows: 51 compulsory GPA courses totaling 109 credits, 3 non-GPA modules totaling 5 credits, 5 orientation modules with unspecified credits.
- Compulsory GPA semester totals: 15, 18, 15, 16, 12, 12, 12, 9.
- Electives are added from each student's own records. Minimum elective credits in the handbook are 16; total minimum degree GPA credits are 125.
- GPA is credit-weighted. E results retain their credits with zero points. Blank/pending/non-GPA results are excluded.
- Full precision is retained internally; displayed GPA is rounded to two decimal places.
- Grade scale: A+/A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D+ 1.3, D 1.0, E 0.
- The supplied handbook caps repeat grades at C but does not specify attempt replacement policy. The tool withholds GPA for unresolved GPA repeats. It requires the student to confirm the department-approved single effective grade, and blocks repeated grades above C.
- Official rounding, final-degree year weighting and later intake changes are not established by the supplied pages. The tool describes its output as a current calculated GPA.

## Checks already completed

- All course rows transcribed and compulsory credit totals independently checked.
- 18 meaningful Node calculation tests passed.
- JavaScript syntax checks passed.
- Source review completed. Four integration issues were found and fixed before deployment: repeat-confirmation wording, pending CSV inclusion flags, import overwrite checks, and a brand-link reload that could discard unsaved work.
- An unsaved-work navigation guard was added.
- Final browser visual and interaction testing is NOT completed.
- Actual browser PDF output and saved-file round trips are NOT yet verified.

## Hosted version

Private deployment succeeded:

`https://ruhuna-abm-results.fairypanda5.chatgpt.site`

- Project ID: `appgprj_6ad71ef6d418819199ec41590b3a78a8`
- Deployed source commit: `5813fb6c30a9f45176d53f1418157382ea740779`
- Version ID: `appgprj_6ad71ef6d418819199ec41590b3a78a8~appgver_7684d429ad0081918cf7a658a4d8555c`
- Deployment ID: `appgdep_6ad722207ddc819188a5a4399b17cc81`
- Deployment status: succeeded.
- Archive: `C:\Users\Asus\Desktop\LinkedIn\abm-batch-tool-package.tar.gz`

The website is still OWNER PRIVATE. Do not say the batch can already access it.

Automatic approval review rejected the attempt to set public access because the request for a shareable tool did not explicitly authorize public audience scope. An explicit public-access question was sent; no affirmative answer had arrived when the user asked to stop. Do not retry public access without that answer, and do not work around the rejection.

Browser testing reached the private site's ChatGPT sign-in screen. The browser's available account was different from the Site owner, so no account was selected. Do not log into a different account speculatively.

## Packaging and preview notes

The Sites source helper successfully committed and pushed source, then failed at its packaging step because the Windows environment lacks Bash/WSL.

The archive was subsequently prepared with the plugin's own `prepare-site-build.cjs` helper and Windows native `tar`. The staging destination was explicitly verified inside the workspace before calling the helper. This succeeded and the resulting archive was deployed.

Local preview initially ran inside the sandbox and timed out. A later local-only server was started outside the network sandbox. Browser observation of an earlier error tab was blocked because that tab had a data URL; do not bypass that browser policy. Use a normal authorized HTTP/HTTPS preview when resuming.

## Remaining work in order

1. Resume only when the user asks.
2. Obtain/recognize explicit user authorization for a public anyone-with-link tool if batch sharing is still wanted. Preserve private access until authorized.
3. Finish browser testing on a permitted preview or the authorized hosted site:
   - desktop and 390px mobile layout;
   - grade selection and weighted GPA updates;
   - non-GPA/E/pending behavior;
   - elective add/edit/remove and duplicate code handling;
   - unresolved and confirmed repeat behavior;
   - JSON save/open round trip and CSV contents;
   - complete multi-semester print/PDF layout.
4. Fix any observed defects and publish changes to the SAME Site project. Do not create another Site.
5. Confirm sharing/access and return the final batch-ready link with brief instructions.

The site features are implemented and saved. Browser/PDF verification and public sharing are the outstanding work.
