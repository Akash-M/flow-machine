import { NavLink, useLocation } from 'react-router-dom';

import { DashboardNavigationItem } from '../hooks/useFlowMachineApp';

interface AppSidebarProps {
  navigationItems: DashboardNavigationItem[];
}

interface TopNavButtonProps {
  description: string;
  href: string;
  label: string;
}

function TopNavButton({ description, href, label }: TopNavButtonProps) {
  const location = useLocation();
  const isWorkflowEditorRoute = href === '/workflow-editor' && /^\/workflows\/[^/]+\/?$/.test(location.pathname);

  return (
    <NavLink
      end
      className={({ isActive }) => `app-topbar__tab${isActive || isWorkflowEditorRoute ? ' app-topbar__tab--active' : ''}`}
      title={description}
      to={href}
    >
      <span className="app-topbar__tab-label">{label}</span>
    </NavLink>
  );
}

export function AppSidebar({ navigationItems }: AppSidebarProps) {
  return (
    <header className="app-topbar">
      <div className="app-topbar__brand-row">
        <div className="app-topbar__brand">
          <h1>Flow Machine</h1>
        </div>
      </div>

      <nav className="app-topbar__tabs" aria-label="Dashboard views">
        {navigationItems.map((item) => (
          <TopNavButton description={item.description} href={item.href} key={item.id} label={item.label} />
        ))}
      </nav>
    </header>
  );
}