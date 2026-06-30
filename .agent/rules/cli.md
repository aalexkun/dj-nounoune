---
trigger: always_on
---
CLI Project Structure & Rules

Framework: This project uses `nest-commander` to provide a Command Line Interface. All CLI-related code must reside in the `src/cli` directory.

Directory Organization:
* Commands must be grouped by domain in subdirectories: `src/cli/<domain>/`.
* Example: `src/cli/spotify/`, `src/cli/music/`.

Command Definition:
* Top-level commands: Use the `@Command()` decorator from `nest-commander`.
* Sub-commands: Use the `@SubCommand()` decorator for actions under a main command.
* Each command/sub-command must be a class decorated with `@Injectable()` and extend `CommandRunner`.

Registration:
* All command and sub-command classes must be imported and added to the `CommandProviders` array in `src/cli/command.provider.ts`.
* These providers are automatically injected into the `AppModule`.

Implementation Best Practices:
* Thin Wrappers: Commands should remain lightweight. They are responsible for parsing input (options/arguments) and calling the appropriate methods in the application services.
* Service Injection: Inject required services into the command's constructor using standard NestJS Dependency Injection.
* Logic Location: All business logic, data processing, and external API calls must stay within Service classes (e.g., `src/services/`).
* Options: Use the `@Option()` decorator to define command flags. Ensure proper type parsing (e.g., `parseInt` for numbers) within the option handler if necessary.

Execution:
* The CLI entry point is `src/cli.ts`.
* For development, use: `npm run cli -- <command> [options]`.
