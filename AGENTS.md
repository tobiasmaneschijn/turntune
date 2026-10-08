# Agent instructions

## UI skills

For frontend implementation or design review, read
`.agents/skills/no-slop-ui/SKILL.md` and `.agents/skills/impeccable/SKILL.md`.
Use Impeccable's `distill` command to simplify an existing interface.
Preserve the project's design system, accessibility, and the copy rules below
when applying these skills. Installation details are in `.agents/skills/README.md`.

## Keep language restrained

Use plain, direct language in product copy, documentation, and replies. Tone down
the excessive subtext AI tends to add: redundant subtitles, helper paragraphs,
reassurance, promotional language, and explanations of obvious actions.

## Product and UI copy

- Default to a clear label or heading without a subtitle. Add supporting text only
  when it supplies information the user needs to act correctly.
- Do not add a description to every card, section, dialog, setting, or empty state.
  A component's optional description slot does not need to be filled.
- Avoid restating the label. A "Queue" heading does not need "Manage your queue,"
  and a "Search" field does not need "Search for what you're looking for."
- Keep necessary helper text short and specific. Use it for unfamiliar behavior,
  input requirements, permissions, consequences, or recovery steps.
- State errors and the next useful action directly. Avoid generic reassurance,
  blame, dramatic language, or claims that a problem is easy to fix.
- Prefer concrete verbs and familiar terms. Avoid slogans, hype, cute filler, and
  phrases such as "seamlessly," "unlock," "elevate," or "your journey."
- Preserve accessibility labels, required format hints, meaningful state feedback,
  and important warnings. Brevity must not make controls ambiguous.
- When editing a surface, remove redundant copy instead of replacing it with
  equally unnecessary wording. Keep copy changes within the requested scope.

## Assistant communication

- Lead with the answer or result. Keep simple updates and confirmations brief.
- Explain decisions only when the reason helps the user assess the result.
- Do not invent motives, emotions, hidden goals, or deeper meaning behind a request.
- Avoid unsolicited praise, repeated reassurance, rhetorical questions, and canned
  introductions or conclusions.
- Avoid artificial contrasts such as "This isn't about X; it's about Y" unless
  the distinction resolves an actual misunderstanding.
- Mention assumptions, uncertainty, and limitations when they materially matter.
  Report validation accurately without narrating every routine step.
- Follow explicit requests for detail. Restraint means removing filler, not omitting
  information the user asked for.

## Examples

| Context | Preferred copy | Avoid |
| --- | --- | --- |
| Queue section | "Queue" | "Queue" + "Curate the soundtrack to your shared listening journey." |
| Empty queue | "Queue is empty." + "Add a track" button | "Your next great listening experience starts here. Add a track to get the vibes going!" |
| Failed save | "Couldn't save. Try again." | "Don't worry! We hit a small hiccup while saving your changes." |
| Necessary helper text | "Only moderators can change this setting." | "Take control of your room settings with ease." |

Before finishing, remove any sentence that merely repeats a nearby label or adds
tone without useful meaning. Keep details that explain behavior or support a
decision.
