import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const token = request.cookies.get("access_token")?.value;

    const isNotesRoute = request.nextUrl.pathname.startsWith("/notes");

    if (isNotesRoute && !token) {
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/notes/:path*"],
};