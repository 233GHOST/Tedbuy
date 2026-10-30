// Copied word for word from the website's sign-up terms modal
// (src/components/Navbar.tsx, "Tedbuy Policies"). Keep the two in sync.

export const TERMS_TITLE = 'Tedbuy Policies';
export const TERMS_SUBTITLE = 'Please review carefully before agreeing to create your account.';
export const TERMS_AGREE_LABEL = 'I agree to these terms & policies';

/** The section shown as a highlighted warning box rather than a numbered heading. */
export const TERMS_WARNING_TITLE = 'CRITICAL PEER SAFETY WARNING';

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Agreement to Terms & General Usage',
    body: 'Welcome to TedBuy Ghana. By creating an account, you agree to comply with our peer-to-peer advertising policies and general terms of service. You represent and warrant that you are at least 18 years of age or accessing the service under the supervision of a parent or guardian.',
  },
  {
    title: 'Listing and Safety Regulations',
    body: 'No illegal merchandise, counterfeit brand replicas, weapons, hazardous substances, or unauthorized financial offers are permitted on our platform. All users must supply accurate, non-misleading, and complete information for listings, including correct pricing, locations, and actual images of the item.',
  },
  {
    title: TERMS_WARNING_TITLE,
    body: 'Never send advance deposits, mobile money transfers, or delivery fees before verifying physical product ownership and inspecting the item in person. Always meet in a well-lit, busy public space to trade.',
  },
  {
    title: 'Peer-to-Peer Disclaimer & Liability',
    body: 'TedBuy is solely an online advertising and directory venue. All physical inspections, item verifications, delivery arrangements, and final financial payments are conducted solely between you and the other party. We never hold escrow funds, verify financial credit, or mediate delivery/shipping of any hardware or services.',
  },
  {
    title: 'Zero-Tolerance Anti-Scam & Fraud Prevention',
    body: "Any attempt to spam, defraud, clone listings, post false reviews, or impersonate other users will result in immediate and permanent account suspension. We cooperate fully with local law enforcement and regulatory authorities to ensure Ghana's digital classifieds remain safe.",
  },
];
