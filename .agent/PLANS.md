# ExecPlan guidance

This file is a compatibility pointer. The canonical requirements and template are in the
Crafted plugin's `skills/exec-plan/references/PLANS.md`; do not maintain another copy here.

Before authoring or executing a nontrivial implementation plan, load `crafted:exec-plan` and
read that canonical document. Resolve it through the installed skill, or under
`$CRAFTED_PLUGIN/skills/exec-plan/references/PLANS.md` when a plugin checkout is selected.
The workspace default is `<workspace-root>/crafted-plugin/plugins/crafted`. Worktrees must
resolve the workspace root rather than assume their parent is the main checkout.

Store feature plans in this repo's `.agent/exec-plans/`. Reuse settled PRD/TRD decisions;
link one authoritative cross-repo contract. Keep progress, decisions, verification evidence,
and remaining work current. Code delivery ends with required checks, technical review, and PRs.
Product validation, tester, manual suites, audits, tickets, and release notes are separate
selected workflows.
