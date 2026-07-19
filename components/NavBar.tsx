import Link from "next/link";

export function NavBar() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-900">
          SENSE
        </Link>
        <div className="flex gap-4 text-sm text-zinc-600">
          <Link href="/plan" className="hover:text-zinc-900">
            My plan
          </Link>
          <Link href="/audit" className="hover:text-zinc-900">
            Agent activity
          </Link>
        </div>
      </nav>
    </header>
  );
}
