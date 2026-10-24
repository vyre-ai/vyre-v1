# Contacts and consent (contacts-link)

Lane L5. Kind module. Status stub. Version 0.1.0.

Requires: records.

## Capabilities (18)

- [contacts.address.add](../capabilities/contacts.address.add.md): Add an email, phone or handle to a contact
- [contacts.address.list](../capabilities/contacts.address.list.md): List every email, phone and handle held by a contact
- [contacts.address.remove](../capabilities/contacts.address.remove.md): Remove an email, phone or handle from a contact
- [contacts.address.set_primary](../capabilities/contacts.address.set_primary.md): Make one address the primary email or phone of a contact
- [contacts.apply_optout](../capabilities/contacts.apply_optout.md): Apply an inbound STOP or UNSUBSCRIBE: suppress the address and set the contact preferences
- [contacts.deliverability](../capabilities/contacts.deliverability.md): Deliverability badge of a contact: good, risky, bounced or complained
- [contacts.dnd_screen](../capabilities/contacts.dnd_screen.md): Screen candidates before they are ADDED to an audience, campaign, Journey enrolment or import. Adds only: it never removes, unsubscribes or deletes anyone already present
- [contacts.duplicates.dismiss](../capabilities/contacts.duplicates.dismiss.md): Mark a suggested pair as not duplicates
- [contacts.duplicates.list](../capabilities/contacts.duplicates.list.md): Likely duplicate contacts or companies, with the reasons
- [contacts.preferences.get](../capabilities/contacts.preferences.get.md): Read the Contact preferences group of a contact
- [contacts.preferences.set](../capabilities/contacts.preferences.set.md): Set consent, Do-not-contact and channel opt-outs (source and time are stamped)
- [contacts.resolve](../capabilities/contacts.resolve.md): Find the contact or company that owns an email, phone or handle (sure and unsure matches)
- [contacts.route_owner](../capabilities/contacts.route_owner.md): Who receives an unowned reply: contact owner, then campaign owner, then the shared inbox
- [contacts.suppression.add](../capabilities/contacts.suppression.add.md): Add addresses to the suppression list (bounces, complaints, opt-outs and manual adds)
- [contacts.suppression.check](../capabilities/contacts.suppression.check.md): Check addresses against the suppression list (the single send API calls this for every sender)
- [contacts.suppression.import](../capabilities/contacts.suppression.import.md): Add many addresses from a file to the suppression list
- [contacts.suppression.list](../capabilities/contacts.suppression.list.md): List the suppression list
- [contacts.suppression.remove](../capabilities/contacts.suppression.remove.md): Take an address off the suppression list (a person decision, audited)

## Events (6)

- [contact.address_added](../events/contact.address_added.md): An email, phone or handle was added to a contact
- [contact.address_removed](../events/contact.address_removed.md): An email, phone or handle was removed from a contact
- [contact.dnd_screened](../events/contact.dnd_screened.md): A Do-not-contact screening ran over new adds (never removes anyone)
- [contact.preferences_changed](../events/contact.preferences_changed.md): Consent, Do-not-contact or channel opt-outs changed
- [suppression.added](../events/suppression.added.md): An address was added to the suppression list
- [suppression.removed](../events/suppression.removed.md): An address was removed from the suppression list by a person
