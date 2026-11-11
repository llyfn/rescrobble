/** Every user-facing string, so a translation can replace this module without touching components. */
export const strings = {
  brand: "rescrobble",
  loading: "Loading",
  signOut: "Sign out",
  sessionEnded: "Your Last.fm session has ended. Log in again.",
  signedOut: {
    heading: "Add the plays Last.fm missed",
    intro: "Scrobble a single track or a whole album by hand, with each track timed from its length. Every play reports back whether Last.fm kept it.",
    privacy: "You sign in on last.fm. rescrobble never sees your password.",
    logIn: "Log in with Last.fm",
    extension: "Need to edit or delete scrobbles? The rescrobble browser extension does that.",
    extensionStatus: "Coming soon",
    signInFailed: "Sign-in didn't complete. Try again.",
  },
  footer: "Powered by AudioScrobbler",
  privacyLink: "Privacy",
  privacy: {
    heading: "Privacy",
    updated: "Last updated 11 November 2026",
    sections: [
      {
        heading: "Signing in",
        body: [
          "You sign in on last.fm, so rescrobble never sees your Last.fm password. Last.fm then gives rescrobble a session key, which rescrobble keeps encrypted in your browser: in a cookie for the Web App, and in the extension's storage for the extension.",
          "The rescrobble server decrypts the session key only to sign your requests to Last.fm. It doesn't store it.",
        ],
      },
      {
        heading: "What the server keeps",
        body: [
          "Scrobbles you add pass through the server on their way to Last.fm and aren't kept. To limit how fast one account can submit, the server records the time and number of scrobbles of each submission under a one-way hash of your session. Records older than a day are deleted the next time you submit.",
          "The server keeps nothing else: no listening history, no email address, no profile.",
        ],
      },
      {
        heading: "What stays in your browser",
        body: [
          "The extension keeps a copy of your Last.fm listening history, your change log and your jobs on your device. They are never sent to rescrobble. Removing the extension deletes them.",
          "The extension reads your history from the Last.fm API directly, and edits or deletes scrobbles on last.fm in a tab signed in as you. Your last.fm website login never leaves your browser.",
        ],
      },
      {
        heading: "No tracking",
        body: [
          "rescrobble has no analytics and no ads, and sets no cookie other than the sign-in cookie.",
          "The Web App and the server run on Cloudflare, which processes requests in order to deliver them.",
        ],
      },
      {
        heading: "Your control",
        body: [
          "Signing out removes the sign-in cookie or the extension's token. You can also revoke rescrobble's access at any time in your Last.fm settings, under Applications.",
          "Questions go to the project's GitHub issues.",
        ],
      },
    ],
    contact: "github.com/llyfn/rescrobble/issues",
  },
};
