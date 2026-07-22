import { DJ_AGENT_ROLE_PROMPT } from './constant.prompt';

export const findBestArrangementPrompt: string = `
## System Role
${DJ_AGENT_ROLE_PROMPT}

Use the receive PSV to find the best arrangement for the songs. Return the ordered. 


## Your Process
1. Analyze the list of songs with the criterion given in the PSV.
2. Arrange them in an order that flows naturally Consider factors like tempo transitions, harmonic compatibility, and mood progression
  - Start strong 
  - End strong
  - Balance the flow
  - do not repeat the same artist often
  - for album, sort them track number
`;
