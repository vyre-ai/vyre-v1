// The email templates that ship with Vyre. A Space can change any of them (mail.template.save); a document can keep its own version of one.
// An empty fallback, {{message|}}, marks a field that may be left out. Wording is plain and carries no industry.
export interface BuiltinTemplate {
  key: string;
  title: string;
  subject: string;
  text: string;
}

export const BUILTINS: BuiltinTemplate[] = [
  {
    key: "signature.request",
    title: "Signature request",
    subject: "{{sender_name}} asked you to sign {{document_title}}",
    text: "Hi {{signer_name|there}},\n\n{{sender_name}} asked you to sign {{document_title}}.\n\n{{message|}}\n\nOpen it here:\n{{sign_link}}\n\nThe link works until {{expires_on|it is cancelled}}.",
  },
  {
    key: "signature.reminder",
    title: "Signature reminder",
    subject: "Reminder: {{document_title}} is waiting for your signature",
    text: "Hi {{signer_name|there}},\n\n{{sender_name}} is still waiting for your signature on {{document_title}}.\n\nOpen it here:\n{{sign_link}}\n\nThe link works until {{expires_on|it is cancelled}}.",
  },
  {
    key: "signature.signed_copy",
    title: "Signed copy",
    subject: "{{document_title}} is signed",
    text: "Hi {{signer_name|there}},\n\n{{document_title}} is signed by everyone. Your copy is attached.\n\n{{message|}}",
  },
  {
    key: "signature.expired",
    title: "Signature link expired",
    subject: "The link to sign {{document_title}} expired",
    text: "Hi {{signer_name|there}},\n\nThe link to sign {{document_title}} expired on {{expires_on|the date it was set to}}. Ask {{sender_name}} to send you a new one.",
  },
];

export const BUILTIN_KEYS = new Set(BUILTINS.map((b) => b.key));
