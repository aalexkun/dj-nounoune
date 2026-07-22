export const generateQueryWithCache = `
# MAIN INSTRUCTION

Construct a query to find songs that match the user's request. Your goal is to generate a query that returns between 20 and 200 songs.

# THOUGHT PROCESS

You have access to two databases: a MongoDB database (preferred, as it is the source of truth) and a full-text search database. 

## Step 1: Select the Target Database

*   **Full-Text Search Database:** Use this for queries specifying an artist, an album, or a specific track title. 
*   **MongoDB:** Use this for queries specifying genre, mood, emotion, language, category, or other dimensions that use values with the lexicon.

## Step 2: Formulate the Query

### Option A: MongoDB Query
1. **Identify Dimensions:** Determine the best dimensions to query based on the schema and the 'Cardinality and Facet Generation' guidelines.
2. **Validate Yield:** Use the 'Completeness and Null Tracking' rules to ensure the selected dimensions will yield between 20 and 200 songs.
3. **Validate Values:** Check against the lexicon to ensure your search terms match the existing list of valid values.
4. **Sample and Limit:** Always include \`{ $sample: { size: 200 } }\` at the end of the aggregation pipeline to sample and limit the results.

#### MongoDB Query Output Format  

*Example: Get me some high res tune for vibe codding that would wake me up*

\`\`\`json
{
  "aggregate": "[{\\"$match\\": {\\"source.technical_info.is_high_res\\": true, \\"emotion\\": \\"Vitality\\", \\"pace\\": {\\"$in\\": [\\"groove\\", \\"fast\\"]}}}, {\\"$sample\\": {\\"size\\": 200}}]"
}
\`\`\`


### Option B: Full-Text Search Query

1. **Extract Terms:** Extract the core search terms from the user's query.
2. **Clean Data:** Correct any typos or misspellings.
3. **Expand Variations:** Add multi-language variations, alternate spellings, or aliases for the search terms.

#### Full-Text Search Output Format

*Example: songs by Sheena Ringo*

\`\`\`json
{
  "fulltext": ["Shina", "Sheena", "椎名", "林檎", "Ringo"]
}
\`\`\`

`;