# ABM Results Desk

A browser-only results and current GPA calculator for the University of Ruhuna BSc Honours in Agribusiness Management batch. Source curriculum and grading rules are transcribed from the supplied Faculty of Agriculture handbook 2021/22, pp. 30–36.

No academic data is sent to a server. Entries stay in memory by default. Students can opt into local storage, save/open a JSON progress file, export CSV, and print a student-prepared academic summary to PDF.

## Source scope

The catalogue contains 51 compulsory GPA courses (109 credits), 3 non-GPA modules (5 credits), and 5 orientation modules with unspecified credits. Electives must be entered from the student's own records. Credits and names can be corrected for intake changes. Those changes are shown in the report.

The GPA uses weighted course credits. Blank and pending results are excluded; an E retains its credits in the denominator. Cumulative GPA is computed from all included weighted points. Display rounding is two decimal places, not a claim about official university rounding.

Repeat replacement policy is not specified in the supplied pages. GPA remains withheld for a repeat until the student confirms the department has verified the single effective result; grades above C on repeats remain blocked. No automated best/latest attempt replacement is assumed.

## Development

Serve `dist` with a static HTTP server. Run `node --test tests/gpa.test.mjs`.

The app is buildless and has no third-party client dependencies. Deployment identity is in `.openai/hosting.json`. Do not put student results or hosting credentials in source.
