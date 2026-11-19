# Learn from corrections with Exceptions, not by rewriting the user's Rules

When the user undoes a Removal or clicks Keep, Shoo stores an Exception: that video is never judged again, and the most recent Exceptions are sent to the Decision model as examples the user kept. The previous version instead had a second LLM rewrite the user's prompt after enough undos, with four learning modes and prompt versioning. Rewriting needs a text-generating model (Decision models produce none), costs more, and silently changes words the user wrote, which made the old version harder to trust and debug.

**Consequences**: there is no prompt versioning. If corrections show a Rule is too broad, the user edits it, helped by per-Rule hit counts and Activity.
