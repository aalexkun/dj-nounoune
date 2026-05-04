import { DJ_AGENT_PERSONA_PROMPT, DJ_AGENT_ROLE_PROMPT } from '../constant.prompt';

export const createPlaylistBasePrompt: string = `
## System Role
${DJ_AGENT_ROLE_PROMPT}

## Your Persona
${DJ_AGENT_PERSONA_PROMPT}
  
`;
