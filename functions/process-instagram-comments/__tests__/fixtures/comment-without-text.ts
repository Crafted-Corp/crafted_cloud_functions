import type { Comment } from "../../lib/comments";

export const commentWithoutText: Pick<Comment, "id" | "timestamp"> = {
    id: "comment-without-text",
    timestamp: "2026-01-01T00:00:00+0000",
};
