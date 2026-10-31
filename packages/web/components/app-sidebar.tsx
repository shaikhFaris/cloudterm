'use client';

import * as React from 'react';
import Link from 'next/link';
import { dashboardRoutes } from '@/lib/dashboard-routes';

import { NavDocuments } from '@/components/nav-documents';
import { NavMain } from '@/components/nav-main';
import { NavSecondary } from '@/components/nav-secondary';
import { NavUser } from '@/components/nav-user';
import type { AuthUser } from '@/lib/auth-types';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import {
  LayoutDashboardIcon,
  Settings2Icon,
  CircleHelpIcon,
  SearchIcon,
  CommandIcon,
  FlaskConical,
  RotateCcwClock,
} from 'lucide-react';

const data = {
  navMain: [
    {
      title: dashboardRoutes.home.title,
      url: dashboardRoutes.home.href,
      icon: <LayoutDashboardIcon />,
    },
  ],
  navSecondary: [
    {
      title: 'Settings',
      url: '#',
      icon: <Settings2Icon />,
    },
    {
      title: 'Get Help',
      url: '#',
      icon: <CircleHelpIcon />,
    },
    {
      title: 'Search',
      url: '#',
      icon: <SearchIcon />,
    },
  ],
  lab: [
    {
      name: dashboardRoutes.newLabs.title,
      url: dashboardRoutes.newLabs.href,
      icon: <FlaskConical />,
    },
    {
      name: 'History',
      url: '#',
      icon: <RotateCcwClock />,
    },
  ],
};
export function AppSidebar({ user, ...props }: React.ComponentProps<typeof Sidebar> & { user: AuthUser }) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href={dashboardRoutes.home.href} />}
            >
              <CommandIcon className="size-5!" />
              <span className="text-base font-semibold">CloudTerm</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.lab} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: user.email.split('@')[0] || user.email, email: user.email, avatar: '' }} />
      </SidebarFooter>
    </Sidebar>
  );
}
