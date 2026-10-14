export const dashboardRoutes = {
  home: { title: 'Dashboard', href: '/dashboard' },
  newLabs: { title: 'New Labs', href: '/dashboard/new-labs' },
} as const;

export function getDashboardPageTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, '');
  const route = Object.values(dashboardRoutes).find((route) => route.href === path);
  if (route) return route.title;

  const segment = path.split('/').filter(Boolean).at(-1);
  return segment
    ? segment.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : dashboardRoutes.home.title;
}
