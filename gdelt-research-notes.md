# GDELT Research Notes

## Selected New Sentiment Source

The chosen new signal source is **GDELT DOC 2.0**, a public news analytics API that exposes recent news coverage and tone.

## Key Findings

- GDELT DOC 2.0 supports article search across a broader time window and can return structured outputs suitable for dashboards.
- The API exposes modes such as `timelinevolinfo` and `tonechart`, which are useful for deriving both **attention/coverage volume** and **average news tone**.
- This makes it a good independent input for prediction-market scoring because it adds a measurable external signal beyond manual news/social/market sentiment inputs.
- A practical dashboard feature is to query GDELT by a user-entered topic and use returned tone and article volume to compute a normalized external sentiment component.

## Implementation Direction

- Add a backend helper that queries GDELT for a topic.
- Convert returned tone/coverage into a bounded sentiment score.
- Extend the advanced sentiment procedure to accept a topic and incorporate the GDELT-derived score as a fourth weighted input.
- Update the sentiment dashboard to show the external signal and its contribution.
- Add tests for the revised weighting logic.

## UI Verification Findings

The upgraded `/sentiment` dashboard renders correctly in the app shell, including the new sidebar entry, topic input, refresh button, external topic card, and weighted contribution tiles.

At the time of inspection, the page still showed `External Coverage: 0`, `Normalized Signal: +0.00`, and an active loading message. That indicates the backend integration is wired through the UI, but the live external response path still needs validation or debugging before the feature can be considered complete.

## Live Validation Update

The live dashboard query is now returning a non-zero external signal payload after the backend source swap. The page shows `External Coverage: 2` and `Signal Confidence: 12%`, which confirms the runtime-accessible external source is now flowing through the UI.

The remaining gap is presentation consistency: the dashboard text still refers to GDELT and article tone even though the backend source has been switched to Wikimedia pageviews and attention momentum. The next update should align labels, descriptions, and metric naming with the new source semantics.
