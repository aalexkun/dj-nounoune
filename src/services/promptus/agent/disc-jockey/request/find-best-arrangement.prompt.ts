import { DJ_AGENT_ROLE_PROMPT } from './constant.prompt';

export const findBestArrangementPrompt: string = `
# System Role
${DJ_AGENT_ROLE_PROMPT}

# Objective
You are receiving a list of song information from a database in a PSV format. You objective is to assume a quality check to answer the user query, and reorder the songs in an order that flows naturally. Consider factors like tempo transitions, harmonic compatibility, and mood progression. Start strong, end strong, balance the flow, and do not repeat the same artist often. For albums, sort them by track number.

1. Remove any songs that may has slip in as a false positive during the database querying. 
2. Based on the query, order the songs into a natural way
    - tempo and phases
    - songs topic
    - album track number
    - do not repeat the same artist often
`;
