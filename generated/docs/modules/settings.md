# Settings (settings)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (14)

- [settings.copy_profile](../capabilities/settings.copy_profile.md): Apply values read from another Space to my profile here; the title is never copied
- [settings.copy_source](../capabilities/settings.copy_source.md): Profile values of mine that may be copied into another Space: photo, name, handle, time zone and hours, contact (title never)
- [settings.floor_set](../capabilities/settings.floor_set.md): Owner floor: set the least strict value anyone in the Space may choose for a floorable setting
- [settings.get](../capabilities/settings.get.md): One setting with its value, default and floor
- [settings.kit.get](../capabilities/settings.kit.get.md): The Kit chosen for this Space, my own choice, and the one in effect
- [settings.kit.set_mine](../capabilities/settings.kit.set_mine.md): Choose my own Kit for this Space (null follows the Space)
- [settings.kit.set_space](../capabilities/settings.kit.set_space.md): Choose the Kit for the whole Space
- [settings.list](../capabilities/settings.list.md): Rows of one page (or all) with the value that applies to me
- [settings.pages](../capabilities/settings.pages.md): The ten settings pages in their two groups (named after the Space, and Everywhere) with row counts
- [settings.reset](../capabilities/settings.reset.md): Put one of my settings back to the Space default
- [settings.reset_space](../capabilities/settings.reset_space.md): Put a Space-wide setting back to its shipped default
- [settings.search](../capabilities/settings.search.md): Find settings rows by words (Cmd-F)
- [settings.set](../capabilities/settings.set.md): Change one of my settings; saves as made and returns the previous value so Undo is one call
- [settings.set_space](../capabilities/settings.set_space.md): Change a Space-wide setting (the permission of the row decides who may; policy.manage by default)

## Events (2)

- [settings.changed](../events/settings.changed.md): A setting changed (settings hold no secrets)
- [settings.floor_changed](../events/settings.floor_changed.md): The owner floor on a setting changed; nobody may go below it
