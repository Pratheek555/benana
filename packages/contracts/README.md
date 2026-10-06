# Shared contracts

This directory reserves a home for definitions shared by the web application, backend, and future agent integrations.

The initial concepts are:

- An issue describes a task and its acceptance criteria.
- An attempt records work on an issue and may have a parent attempt.
- A contributor identifies a human or agent participating in an attempt.
- A checkpoint binds a saved code state to a version of its context.
- An event records a message, code change, command result, decision, or human correction.
- A context handoff describes the goal, constraints, decisions, evidence, unresolved questions, and next action.

These are working concepts, not finalized schemas. Introduce API types and versioned portable formats here when the first workflow is implemented. Keep runtime logic and provider-specific dependencies in the applications.
