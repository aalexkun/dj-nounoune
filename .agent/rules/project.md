---
trigger: always_on
---

This is a typescript project. 

This uses Nestjs framework

Use strong typescript type

Alwaysnpm run build to test the typescript error.



You need to run a build command in a remote SSH environment. Because of a known SSH bug where dangling child processes (like telemetry or worker pools) keep output pipes open, standard blocking commands will cause your session to hang indefinitely. 

To work around this behaviour, you must execute the build using a non-blocking pattern and redirect the output. 

Please perform the following steps exactly as written:

1. Execute the build command using the following format to enforce CI mode and redirect all output to a file:
   `CI=true npm run build > build_output.log 2>&1`

2. When executing the command, you MUST use the non-blocking execution parameter and set it to wait 5 seconds:
   `WaitMsBeforeAsync: 5000`

3. After the 5 seconds have passed and you have regained control, use your file reading tools to read the contents of `build_output.log`.

4. Analyse the contents of `build_output.log` to determine if the build succeeded or failed, and report the final status back to me. Do not wait for the original execution tool to return an exit code.