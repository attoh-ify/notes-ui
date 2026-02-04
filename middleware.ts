import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const allCookies = request.cookies.getAll();
    const token = request.cookies.get("access_token")?.value;

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