# Settings (settings)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (18)

- [settings.contact.status](../capabilities/settings.contact.status.md): Whether my email and phone are verified, whether a code is waiting, and whether this Space can send one (no phone line: no Verify)
- [settings.contact.verify_confirm](../capabilities/settings.contact.verify_confirm.md): Confirm the code that was sent; the tick shows only after this
- [settings.contact.verify_start](../capabilities/settings.contact.verify_start.md): Send a 6-digit code to my email or phone through the Space mail sender or its phone line; it lasts 10 minutes, 3 an hour
- [settings.copy_profile](../capabilities/settings.copy_profile.md): Apply values read from another Space to my profile here; the title is never copied
- [settings.copy_source](../capabilities/settings.copy_source.md): Profile values of mine that may be copied into another Space: photo, name, handle, time zone and hours, contact (title never)
- [settings.floor_set](../capabilities/settings.floor_set.md): Owner floor: set the least strict value anyone in the Space may choose for a floorable setting
- [settings.get](../capabilities/settings.get.md): One setting with its value, default and floor
- [settings.kit.get](../capabilities/settings.kit.get.md): The Kit chosen for this Space, my own choice, and the one in effect
- [settings.kit.set_mine](../capabilities/settings.kit.set_mine.md): Choose my own Kit for this Space (null follows the Space)
- [settings.kit.set_space](../capabilities/settings.kit.set_space.md): Choose the Kit for the whole Space
- [settings.list](../capabilities/settings.list.md): Rows of one page (or all) with the value that applies to me
- [settings.pages](../capabilities/settings.pages.md): The settings pages a person has, with row counts
- [settings.public_of](../capabilities/settings.public_of.md): A teammate's time zone, working hours, pronouns, title and a public phone, only when they set them themselves
- [settings.reset](../capabilities/settings.reset.md): Put one of my settings back to the Space default
- [settings.reset_space](../capabilities/settings.reset_space.md): Put a Space-wide setting back to its shipped default
- [settings.search](../capabilities/settings.search.md): Find settings rows by words (Cmd-F)
- [settings.set](../capabilities/settings.set.md): Change one of my settings; saves as made and returns the previous value so Undo is one call
- [settings.set_space](../capabilities/settings.set_space.md): Change a Space-wide setting (the permission of the row decides who may; policy.manage by default)

## Events (6)

- [settings.changed](../events/settings.changed.md): A setting changed (settings hold no secrets)
- [settings.contact_code_failed](../events/settings.contact_code_failed.md): A verification code was refused: wrong, expired, too many tries or not asked for
- [settings.contact_code_sent](../events/settings.contact_code_sent.md): A verification code was sent to my email or phone (the code is never in the log)
- [settings.contact_unverified](../events/settings.contact_unverified.md): My email or phone changed, so its tick went
- [settings.contact_verified](../events/settings.contact_verified.md): My email or phone was confirmed with its code
- [settings.floor_changed](../events/settings.floor_changed.md): The owner floor on a setting changed; nobody may go below it
