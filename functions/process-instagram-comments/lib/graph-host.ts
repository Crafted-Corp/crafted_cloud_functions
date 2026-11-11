export const graphHostFor = (
    instagramNode?: { api_path?: string } | null,
): "https://graph.instagram.com/v24.0" | "https://graph.facebook.com/v24.0" =>
    instagramNode?.api_path === "instagram" ? "https://graph.instagram.com/v24.0" : "https://graph.facebook.com/v24.0";
