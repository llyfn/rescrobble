import { strings } from "./strings.ts";

export function Footer() {
  return (
    <footer className="footer">
      <a className="rs-attribution" href={strings.lastFmUrl} target="_blank" rel="noopener noreferrer">{strings.footer}</a>
      <a href="/privacy">{strings.privacyLink}</a>
    </footer>
  );
}
