// Lists every manifest. tools/gen/test/manifests.test.ts fails when this drifts from the files on disk.
import type { Manifest } from '../packages/contracts/src/index.ts';
import m_access from './access.ts';
import m_agents from './agents.ts';
import m_audit from './audit.ts';
import m_automations from './automations.ts';
import m_backup from './backup.ts';
import m_calendar from './calendar.ts';
import m_campaigns from './campaigns.ts';
import m_chat from './chat.ts';
import m_computers from './computers.ts';
import m_conflicts from './conflicts.ts';
import m_connectors from './connectors.ts';
import m_console_assistant from './console-assistant.ts';
import m_console_views from './console-views.ts';
import m_contacts_link from './contacts-link.ts';
import m_devices from './devices.ts';
import m_documents from './documents.ts';
import m_email_builder_api from './email-builder-api.ts';
import m_engine from './engine.ts';
import m_esign from './esign.ts';
import m_events from './events.ts';
import m_files from './files.ts';
import m_forms from './forms.ts';
import m_gate from './gate.ts';
import m_git from './git.ts';
import m_github from './github.ts';
import m_google from './google.ts';
import m_governance from './governance.ts';
import m_health from './health.ts';
import m_home from './home.ts';
import m_identity from './identity.ts';
import m_import from './import.ts';
import m_inbox from './inbox.ts';
import m_journeys from './journeys.ts';
import m_kits from './kits.ts';
import m_logs from './logs.ts';
import m_mail from './mail.ts';
import m_mailgun from './mailgun.ts';
import m_mcp from './mcp.ts';
import m_meetings from './meetings.ts';
import m_members from './members.ts';
import m_memory from './memory.ts';
import m_microsoft from './microsoft.ts';
import m_mounts from './mounts.ts';
import m_network from './network.ts';
import m_notifications from './notifications.ts';
import m_portal from './portal.ts';
import m_previews from './previews.ts';
import m_projects from './projects.ts';
import m_records from './records.ts';
import m_reports_client from './reports-client.ts';
import m_resend from './resend.ts';
import m_runbooks from './runbooks.ts';
import m_runs from './runs.ts';
import m_scheduler_api from './scheduler-api.ts';
import m_schema from './schema.ts';
import m_search from './search.ts';
import m_settings from './settings.ts';
import m_sites from './sites.ts';
import m_sources from './sources.ts';
import m_spaces from './spaces.ts';
import m_steps_core from './steps-core.ts';
import m_stripe from './stripe.ts';
import m_sync from './sync.ts';
import m_tasks from './tasks.ts';
import m_telephony from './telephony.ts';
import m_templates from './templates.ts';
import m_terminal from './terminal.ts';
import m_twilio from './twilio.ts';
import m_updates from './updates.ts';
import m_vault_requests from './vault-requests.ts';
import m_vault from './vault.ts';
import m_zoom from './zoom.ts';
import m_documenso from './connectors/documenso.ts';
import m_docusign from './connectors/docusign.ts';
import m_dropbox_sign from './connectors/dropbox-sign.ts';
import m_hubspot from './connectors/hubspot.ts';
import m_default from './kits/default.ts';
import m_estate_planning from './kits/estate-planning.ts';
import m_harbor_studio from './kits/harbor-studio.ts';
import m_law_firm_intake from './kits/law-firm-intake.ts';

export const all: Manifest[] = [
  m_access,
  m_agents,
  m_audit,
  m_automations,
  m_backup,
  m_calendar,
  m_campaigns,
  m_chat,
  m_computers,
  m_conflicts,
  m_connectors,
  m_console_assistant,
  m_console_views,
  m_contacts_link,
  m_devices,
  m_documents,
  m_email_builder_api,
  m_engine,
  m_esign,
  m_events,
  m_files,
  m_forms,
  m_gate,
  m_git,
  m_github,
  m_google,
  m_governance,
  m_health,
  m_home,
  m_identity,
  m_import,
  m_inbox,
  m_journeys,
  m_kits,
  m_logs,
  m_mail,
  m_mailgun,
  m_mcp,
  m_meetings,
  m_members,
  m_memory,
  m_microsoft,
  m_mounts,
  m_network,
  m_notifications,
  m_portal,
  m_previews,
  m_projects,
  m_records,
  m_reports_client,
  m_resend,
  m_runbooks,
  m_runs,
  m_scheduler_api,
  m_schema,
  m_search,
  m_settings,
  m_sites,
  m_sources,
  m_spaces,
  m_steps_core,
  m_stripe,
  m_sync,
  m_tasks,
  m_telephony,
  m_templates,
  m_terminal,
  m_twilio,
  m_updates,
  m_vault_requests,
  m_vault,
  m_zoom,
  m_documenso,
  m_docusign,
  m_dropbox_sign,
  m_hubspot,
  m_default,
  m_estate_planning,
  m_harbor_studio,
  m_law_firm_intake,
];
