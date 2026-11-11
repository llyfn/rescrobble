import { strings } from "./strings.ts";

export function Footer() {
  return (
    <footer className="footer">
      <span>{strings.footer}</span>
      <a href="/privacy">{strings.privacyLink}</a>
    </footer>
  );
}
