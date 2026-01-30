export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not defined");
}

export async function apiFetch<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}/${path}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
    });

    if (response.ok) {
        const result = await response.json();
        if (result.status === true) {
            return result.data;
        } else {
            throw new Error(result.message);
        };
    };

    const message = await response.text();
    throw new Error(message || "API request failed");
}