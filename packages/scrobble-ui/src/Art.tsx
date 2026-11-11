/** Album art beside a suggestion. An empty square stands in when there is none, so names stay aligned. */
export function Art({ src }: { src: string | null }) {
  return src ? <img className="rs-art" src={src} alt="" loading="lazy" /> : <span className="rs-art" aria-hidden="true" />;
}
