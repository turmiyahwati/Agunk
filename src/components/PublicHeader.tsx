"use client";
import { Logo } from "./ui/Logo";
import { ContactBar } from "./ContactBar";

/**
 * Slim sticky header for the public monitoring views.
 * Logo on the left, Contact + Login Admin on the right.
 */
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-bg/70 backdrop-blur-xl">
      <div className="container mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ContactBar />
      </div>
    </header>
  );
}
