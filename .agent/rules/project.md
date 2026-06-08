---
trigger: always_on
---
Project Architecture & Constraints

Framework: This is a TypeScript NestJS project. Adhere strictly to NestJS architectural patterns (Modules, Controllers, Services, and Dependency Injection). Use standard decorators (e.g., @Injectable(), @Controller()).

Strict Typing: >     * Strictly define types using exact primitive types (string, number, boolean), Interfaces, or Classes/DTOs.

Never use the any type unless explicitly approved by the user.

If a payload's shape is truly unpredictable, use unknown and implement proper type-narrowing before accessing its properties.

Testing & Validation: Unit tests are currently bypassed. However, you must prioritize build stability. After implementing new functionality, verify that the application compiles without TypeScript errors by running npm run build.

External Data Validation (Zod): >     * All incoming payloads from external third-party APIs or untrusted ingress JSON must initially be typed as unknown.

You must define a strict Zod schema matching the expected payload structure.

Use this schema to parse and validate the unknown data at the boundaries of the application (e.g., right when the API response is received).

Successfully parsed data must be cast into its inferred TypeScript type (using z.infer<typeof schema>) before propagating into the application services.