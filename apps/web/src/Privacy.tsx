import { Footer } from "./Footer.tsx";
import { strings } from "./strings.ts";

export function Privacy() {
  const s = strings.privacy;
  return (
    <div className="app">
      <header className="rs-topbar">
        <a className="rs-topbar__brand" href="/">{strings.brand}</a>
      </header>
      <main className="page privacy">
        <h1>{s.heading}</h1>
        <p className="rs-hint">{s.updated}</p>
        {s.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <p><a href={`https://${s.contact}`}>{s.contact}</a></p>
      </main>
      <Footer />
    </div>
  );
}
