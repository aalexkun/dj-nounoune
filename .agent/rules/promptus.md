---
trigger: always_on
---

# Promptus Service Structure & Rules

This document outlines the architectural rules and structural guidelines for adding new functionality to the `src/services/promptus` directory, specifically differentiating between **Agents** and **Tools**, and how they are integrated into the system.

## 1. Core Workflow for New Functionality

When adding a new feature (e.g., "Add ability to search for weather"), follow these steps:

1.  **Requirement Analysis**:
    *   Define the code functionality clearly.
    *   **CRITICAL**: If the requirements are vague or you're unsure about the implementation details (e.g., which API to use, what parameters are needed), **ask the user for clarification** before proceeding.
2.  **Determine Implementation Type**:
    *   **Tool Only**: Use if the task is a simple function (e.g., `get_current_time`, `stop_music`).
    *   **Agent + Tool**: Use if the task requires complex reasoning, multiple steps, or specific persona-driven prompts (e.g., `create_playlist`, `query_database`).
3.  **Choose the Parent Agent**:
    *   Determine which agent the new tool should be attached to.
    *   **Top-level Entry Point**: `ChatPromptusRequest` in `src/services/promptus/request/chat.promptus.request.ts` handles all direct user communication. Most user-facing tools should be added here.
    *   **Sub-Agents**: If the tool is specific to a domain (e.g., database specific), it might belong to `QueryDatabaseAgent`.
    *   **UNSURE?**: Ask the user which agent should host the tool.
4.  **Implementation Steps**:
    *   Define the schema in `src/services/promptus/tools/definition/`.
    *   Create the handler in `src/services/promptus/tools/handler/`.
    *   Register the handler in `src/services/promptus/tools.service.ts`.
    *   Add the definition to the chosen `PromptusRequest` class (e.g., `ChatPromptusRequest.tools`).

---

## 2. Core Concepts: Agents vs. Tools

In the `promptus` architecture:
*   **Agents** are the "brains". They interact directly with the LLM (Google GenAI), manage prompt execution loops, keep track of context/history, and automatically invoke function calls. They consume requests and produce structured responses.
*   **Tools** (specifically `ToolHandlers`) are the "hands". They are specific, isolated functions (like querying a database, interacting with the MPD client, or calculating something) that the LLM can request to execute. They do not interact with the LLM directly; they just perform an action and return a `FunctionCallResult`.

---

## 3. Agents (`src/services/promptus/agent/`)

An Agent extends the base `Agent` abstract class (`src/services/promptus/agent.ts`).

### Directory Structure
When creating a new agent (e.g., `MusicSearchAgent`), group all related files in a domain-specific folder:
```text
src/services/promptus/agent/<agent-name>/
├── <agent-name>.agent.ts       # The main agent class extending Agent
├── request/                    # Contains PromptusRequest implementations for this agent
│   └── <action>.request.ts
└── response/                   # Contains Response wrappers for this agent
    └── <action>.response.ts
```

### Requirements for Agents
1.  **Extend Base Agent**: The class must extend `Agent` and define a `name` property.
2.  **Constructor Initialization**: Call `super()` and `this.initialiseAgent(apiKey, toolService, eventEmitter)` in the constructor.
3.  **Implement `wrapResponse`**: You must implement the `wrapResponse` method to map the generic `GenerateContentResponse` to your specific custom response classes based on the `PromptusRequest` type.
4.  **Requests & Responses**: Every prompt interaction should be wrapped in a custom `PromptusRequest` class (to define system instructions, tools, and user prompts) and a corresponding Response class.

---

## 4. Tools (`src/services/promptus/tools/`)

Tools are composed of two parts: the **Definition** (the schema sent to the LLM) and the **Handler** (the actual code executed).

### Directory Structure
```text
src/services/promptus/tools/
├── definition/                         # Tool schemas sent to the LLM
│   └── <domain>-tools.definition.ts
├── handler/                            # Tool logic implementations
│   └── <domain>/
│       └── <action>.handler.ts         # Implements ToolHandler
└── tool.type.ts                        # Core types (ToolHandler, FunctionCallResult)
```

### Requirements for Tools (Handlers)
1.  **Implement `ToolHandler`**: Every tool must implement the `ToolHandler` interface.
2.  **Naming**: The `name` property in the handler **must exactly match** the function name defined in your `ToolDeclaration` schema.
3.  **Execution Logic**: Implement the `execute(args: unknown, sessionId?: string): Promise<FunctionCallResult>` method. Validate `args` thoroughly, as they come directly from the LLM.
4.  **Return Type**: Always return a valid `FunctionCallResult` (e.g., `{ type: 'string', message: '...', name: this.name }`).

### Requirement for Tool Definitions
Define your function schemas in `src/services/promptus/tools/definition/`. These definitions conform to the GenAI SDK's expected structure and are passed to your `PromptusRequest` classes.

### Registration (Crucial Step)
All `ToolHandler` instances **must be registered** in `src/services/promptus/tools.service.ts`.
*   Generic tools are registered in the `constructor`.
*   Agent-specific tools (delegation) are registered in `initialiseAgent`.

```typescript
// Inside ToolsService constructor
this.registerTool(new MyCustomToolHandler(this.someDependency));
```

---

## 5. Agents as Tools (Delegation)

An advanced pattern used in this project is registering an **Agent as a Tool**. This allows a top-level Agent (like the Chat Agent) to delegate complex reasoning to a sub-Agent (like the DiscJockey Agent).

*   **Location**: These handlers reside in `src/services/promptus/tools/handler/agent/`.
*   **Integration**:
    1.  Create a `ToolHandler` that takes the sub-agent in its constructor.
    2.  In the `execute` method, call the sub-agent's specialized method.
    3.  Register this handler in `ToolsService.initialiseAgent`.
    4.  Add the tool definition to the top-level request (e.g., `ChatPromptusRequest.tools`).
