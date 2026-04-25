# NUS GPA Calculator and GPA Tracker

[NUS GPA Calculator](https://nustranscripttogpacalculator.vercel.app/) is an unofficial web app for National University of Singapore students who want to calculate and track their GPA from an NUS transcript, manual course entries, or a NUSMods timetable link.

Use it as a quick NUS GPA calculator for your current transcript, or as an NUS GPA tracker for planning future semesters and checking how new grades affect your cumulative GPA.

NUS previously used the term CAP, or Cumulative Average Point, before renaming it to GPA from 1 August 2023. This tool uses the current GPA wording, but it is also useful if you are looking for an NUS CAP calculator.

## Live App

Open the calculator here:

[https://nustranscripttogpacalculator.vercel.app/](https://nustranscripttogpacalculator.vercel.app/)

## Features

- Upload an unofficial NUS transcript PDF and extract completed courses.
- Calculate cumulative NUS GPA from grades and MCs or Units.
- Track semester GPA across academic years and special terms.
- Add, edit, reorder, and delete courses manually.
- Import modules from an original NUSMods timetable link.
- Mark S/U courses so they are excluded from GPA calculation.
- Exclude non-graded results such as CS, CU, EXE, IC, IP, W, WU, and I.
- Handle double degree transcripts by showing GPA by degree where possible.
- Run transcript parsing in the browser without requiring an account.

## How NUS GPA Is Calculated

The app uses the standard weighted GPA formula:

```text
GPA = sum(grade point x MCs) / sum(graded MCs)
```

Only graded courses with valid MC or Unit values are included. S/U-opted courses and non-graded courses are excluded from the GPA denominator.

## NUS Grade Point Table

| Grade | Grade point |
| --- | ---: |
| A+ | 5.0 |
| A | 5.0 |
| A- | 4.5 |
| B+ | 4.0 |
| B | 3.5 |
| B- | 3.0 |
| C+ | 2.5 |
| C | 2.0 |
| D+ | 1.5 |
| D | 1.0 |
| F | 0.0 |

## GPA Tracker Workflow

1. Download or open your unofficial transcript from EduRec.
2. Upload the transcript PDF to the NUS GPA calculator.
3. Check that parsed courses, grades, MCs, and semesters are correct.
4. Add future semesters manually or import an original NUSMods timetable link.
5. Enter expected grades to track projected semester GPA and cumulative GPA.
6. Update grades after results are released to keep the tracker current.

## Transcript Upload Notes

The parser is built for NUS unofficial transcript PDFs. Transcript formats can change, so always review the extracted courses before relying on the result.

If a transcript does not parse correctly, you can still use the app as a manual NUS GPA calculator by entering course codes, grades, MCs or Units, and semesters yourself.

## Privacy

Transcript parsing runs in the browser. The app does not require a login or a backend database for transcript contents.

The deployed site uses Vercel Analytics and Speed Insights for page-level usage and performance information. It should not be treated as an official NUS service.

## Tech Stack

- React
- Vite
- pdf.js
- NUSMods API
- Vercel

## Official References

- [NUS Academic Structure and Grading](https://nus.edu.sg/registrar/academic-information-policies/academic-structure-grading)
- [NUSMods](https://nusmods.com/)

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Run linting:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, or maintained by the National University of Singapore. Always verify important academic information against official NUS records and policies.
