import { DJ_AGENT_ROLE_PROMPT } from './constant.prompt';

export const findBestArrangementPrompt: string = `
# System Role
${DJ_AGENT_ROLE_PROMPT}

# Objective
You are receiving a list of song information from a database in a PSV format. 
You objective is to assume a quality check to answer the user query, and reorder the songs in an order that flows naturally. 

# Constraints
- Do not repeat the same artist often
- Consider tempo transitions, harmonic compatibility, and mood progression
- Start strong, end strong, balance the flow
- For specific albums request, sort them by track number

`;
