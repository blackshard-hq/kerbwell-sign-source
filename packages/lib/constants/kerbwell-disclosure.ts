/**
 * The Australian electronic signing disclosure (fork addition, Kerbwell Sign).
 *
 * This text is versioned. The Kerbwell gate shows the signer the same wording at consent and
 * sends `consent_version` and `consent_hash` in the signer assertion, which the fork records as
 * KERBWELL_CONSENT_GIVEN. `consent_version` must equal KERBWELL_DISCLOSURE_VERSION and
 * `consent_hash` must equal KERBWELL_DISCLOSURE_SHA256, the SHA-256 (hex) of
 * kerbwellDisclosureCanonicalText() as UTF-8. A wording change is a new version: change the text,
 * bump the version and the date, and update the hash (kerbwell-disclosure.test.ts fails until the
 * three agree).
 *
 * Plain strings, not translation macros: the signed-off wording is the English text itself.
 */

export const KERBWELL_DISCLOSURE_VERSION = 'au-eta-2026-11-v2';

export const KERBWELL_DISCLOSURE_EFFECTIVE = '4 November 2026';

export type KerbwellDisclosureSection = {
  heading: string;
  paragraphs: string[];
  list?: string[];
};

export const KERBWELL_DISCLOSURE_TITLE = 'Electronic signing disclosure and consent';

export const KERBWELL_DISCLOSURE_SECTIONS: KerbwellDisclosureSection[] = [
  {
    heading: 'Signing electronically',
    paragraphs: [
      'You are asked to sign this document electronically. Under the Electronic Transactions Act 1999 (Cth) and the electronic transactions law of your state or territory, an electronic signature is valid when the method identifies you and shows your intention about the document, the method is as reliable as is appropriate for the purpose, and you consent to it.',
    ],
  },
  {
    heading: 'The laws that apply',
    paragraphs: ['Depending on where you and the sender are, one or more of these apply:'],
    list: [
      'Electronic Transactions Act 1999 (Cth)',
      'Electronic Transactions Act 2000 (NSW)',
      'Electronic Transactions (Victoria) Act 2000',
      'Electronic Transactions (Queensland) Act 2001',
      'Electronic Transactions Act 2011 (WA)',
      'Electronic Communications Act 2000 (SA)',
      'Electronic Transactions Act 2000 (Tas)',
      'Electronic Transactions Act 2001 (ACT)',
      'Electronic Transactions (Northern Territory) Act 2000',
    ],
  },
  {
    heading: 'How you are identified',
    paragraphs: [
      'Before the document opens we confirm it is you with a one-time code sent to a second contact channel, and, where the sender requires it, an identity check. The method used, the time, your IP address, your device and your approximate location are recorded on the certificate of completion attached to the signed document.',
    ],
  },
  {
    heading: 'What you agree to',
    paragraphs: ['By continuing you agree to:'],
    list: [
      'sign this document electronically',
      'receive the executed copy and notices about this document by email',
      'keep your contact details with the sender up to date',
    ],
  },
  {
    heading: 'How you sign',
    paragraphs: [
      'Your typed signature is pre-filled with the legal name the sender holds for you, so you can check it before you use it. You can draw your signature instead. The signature is adopted only when you tap Adopt signature.',
      'Each signature and each initial is placed only when you tap it, and no box is ticked for you. By tapping Sign agreement you sign the document and agree to be bound by it.',
    ],
  },
  {
    heading: 'Paper instead',
    paragraphs: [
      'You can ask for a paper copy to sign instead at any time before you sign. Use Request paper under Something wrong?, or contact the agent who sent the document. Asking for paper pauses electronic signing for you.',
    ],
  },
  {
    heading: 'Withdrawing consent',
    paragraphs: [
      'You can withdraw your consent at any time before you tap Sign agreement, by declining or by asking for paper. Withdrawing does not undo a document you have already signed.',
    ],
  },
  {
    heading: 'What you need',
    paragraphs: [
      'A device that can open and read PDF documents, an email account, and a way to download or print the signed copy.',
    ],
  },
  {
    heading: 'Your signed copy',
    paragraphs: [
      'When everyone has signed, the executed PDF is emailed to every party. It carries a digital seal and a certificate of completion, so any change made after signing can be detected. Keep a copy for your records.',
    ],
  },
  {
    heading: 'Documents not signed here',
    paragraphs: [
      'Contracts for the sale of land, and forms that a law requires to be signed on paper or witnessed in person, are not sent for signing through this service.',
    ],
  },
  {
    heading: 'Privacy',
    paragraphs: [
      'The sender collects the identity and signing details above to make and prove the agreement, and keeps them with the signed document. The sender’s privacy policy explains how to access or correct them.',
    ],
  },
];

/**
 * The exact text the hash covers: the version line, the title, then each section's heading,
 * paragraphs and list items, one per line.
 */
export const kerbwellDisclosureCanonicalText = () =>
  [
    `${KERBWELL_DISCLOSURE_VERSION} ${KERBWELL_DISCLOSURE_EFFECTIVE}`,
    KERBWELL_DISCLOSURE_TITLE,
    ...KERBWELL_DISCLOSURE_SECTIONS.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.list ?? []).map((item) => `- ${item}`),
    ]),
  ].join('\n');

export const KERBWELL_DISCLOSURE_SHA256 = 'd9d2a8d9d1de6b4cf0c14af017ec414cfcaa1dec632b2aaf591bdb396270c67e';

/** The short line shown beside the final Sign agreement button. */
export const KERBWELL_SIGN_AGREEMENT_LINE =
  'By tapping Sign agreement I sign this document and agree to be bound by it.';
