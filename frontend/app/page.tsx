import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Legal Discovery Prototype</h1>
      <p className="mt-4 text-lg text-neutral-700">
        Upload case documents and explore a structured knowledge graph of people, organizations,
        events, and claims — with cross-document contradictions surfaced automatically and every
        fact grounded in its source text.
      </p>
      <div className="mt-10 flex flex-col gap-4">
        <Link
          href="/case/demo"
          className="inline-flex w-fit items-center rounded-md bg-accent px-4 py-2 text-white hover:bg-accent/90"
        >
          Open Enron demo case →
        </Link>
        <p className="text-sm text-neutral-500">
          Or upload your own documents from the case workspace.
        </p>
      </div>
    </main>
  );
}
