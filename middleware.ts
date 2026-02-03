import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const allCookies = request.cookies.getAll();
    const token = request.cookies.get("access_token")?.value;

    // This log is our source of truth. Check your Railway logs for this!
    console.log("--- Middleware Check ---");
    console.log("Path:", request.nextUrl.pathname);
    console.log("All Cookies available:", allCookies.map(c => c.name));
    console.log("Token present:", !!token);

    const isNotesRoute = request.nextUrl.pathname.startsWith("/notes");

    if (isNotesRoute && !token) {
        console.log("Redirecting to login: No token found");
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/notes/:path*"],
};