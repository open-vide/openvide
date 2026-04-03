import { DrawerShell } from 'even-toolkit/web';
import type { SideDrawerItem } from 'even-toolkit/web';
import { useLocation } from 'react-router';
import {
  IcMenuHome,
  IcEditChecklist,
  IcFeatAccount,
  IcStatusDisconnected,
  IcFeatTimeCounting,
  IcEditSettings,
  IcStatusFile,
  IcFeatLearnExplore,
} from 'even-toolkit/web/icons/svg-icons';
import { useTranslation } from '../hooks/useTranslation';

const iconProps = { width: 18, height: 18, className: 'text-current' };

function getPageTitle(pathname: string, t: (key: string) => string): string {
  if (pathname === '/') return 'OpenVide';
  if (pathname.startsWith('/workspace')) return t('web.workspace');
  if (pathname.startsWith('/sessions')) return t('web.sessions');
  if (pathname.startsWith('/team-chat')) return t('web.teamChat');
  if (pathname.startsWith('/teams')) return t('web.teams');
  if (pathname.startsWith('/team')) return t('web.team');
  if (pathname.startsWith('/hosts')) return t('web.hosts');
  if (pathname.startsWith('/host')) return t('web.host');
  if (pathname.startsWith('/chat')) return t('web.chat');
  if (pathname.startsWith('/settings')) return t('web.settings');
  if (pathname.startsWith('/guide')) return t('web.guide');
  if (pathname.startsWith('/schedules')) return t('web.schedules');
  if (pathname.startsWith('/files')) return t('web.files');
  if (pathname.startsWith('/diffs')) return t('web.diffs');
  if (pathname.startsWith('/ports')) return t('web.ports');
  if (pathname.startsWith('/prompts')) return t('web.prompts');
  return 'OpenVide';
}

function deriveActiveId(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/workspace')) return '/';
  if (pathname.startsWith('/sessions') || pathname.startsWith('/chat')) return '/sessions';
  if (pathname.startsWith('/teams') || pathname.startsWith('/team')) return '/teams';
  if (pathname.startsWith('/hosts') || pathname.startsWith('/host')) return '/hosts';
  if (pathname.startsWith('/schedules')) return '/schedules';
  if (pathname.startsWith('/files')) return '/files';
  if (pathname.startsWith('/guide')) return '/guide';
  if (pathname.startsWith('/settings')) return '/settings';
  return '/';
}

export function Shell() {
  const location = useLocation();
  const { t } = useTranslation();
  const activeId = deriveActiveId(location.pathname);
  const menuItems: SideDrawerItem[] = [
    { id: '/', label: t('web.workspaces'), section: 'Navigation', icon: <IcMenuHome {...iconProps} /> },
    { id: '/sessions', label: t('web.sessions'), section: 'Navigation', icon: <IcEditChecklist {...iconProps} /> },
    { id: '/teams', label: t('web.teams'), section: 'Navigation', icon: <IcFeatAccount {...iconProps} /> },
    { id: '/hosts', label: t('web.hosts'), section: 'Navigation', icon: <IcStatusDisconnected {...iconProps} /> },
    { id: '/schedules', label: t('web.schedules'), section: 'Tools', icon: <IcFeatTimeCounting {...iconProps} /> },
    { id: '/files?source=drawer', label: t('web.files'), section: 'Tools', icon: <IcStatusFile {...iconProps} /> },
  ];
  const bottomItems: SideDrawerItem[] = [
    { id: '/guide', label: t('web.guide'), icon: <IcFeatLearnExplore {...iconProps} /> },
    { id: '/settings', label: t('web.settings'), icon: <IcEditSettings {...iconProps} /> },
  ];
  const pageTitlePrefix = [...menuItems, ...bottomItems].find((item) => item.id === activeId)?.icon;

  return (
    <DrawerShell
      items={menuItems}
      bottomItems={bottomItems}
      title="OpenVide"
      getPageTitle={(pathname) => getPageTitle(pathname, t)}
      deriveActiveId={deriveActiveId}
      pageTitlePrefix={pageTitlePrefix}
      className="openvide-shell"
    />
  );
}
