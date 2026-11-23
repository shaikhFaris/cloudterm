import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = 'packages/k8s-manager/k8s/k8s-manager-deployment.yaml';
const tag = prompt('Which k8s-manager image tag should be deployed? (e.g. 0.4)')?.trim();

if (!tag || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag)) {
  console.error('Enter a valid Docker tag, such as 0.4.');
  process.exit(1);
}

const image = `k8s-manager:${tag}`;
const confirmation = prompt(`Did you update ${manifestPath} to ${image}? This replaces the Deployment in kind-kind/cloudterm. [y/N]`);
if (!/^y(es)?$/i.test(confirmation?.trim() ?? '')) {
  console.log('Deployment canceled.');
  process.exit(0);
}

const manifest = Bun.YAML.parse(await Bun.file(new URL(`../${manifestPath}`, import.meta.url)).text()) as {
  spec?: { template?: { spec?: { containers?: { name: string; image: string }[] } } };
};
const manifestImage = manifest.spec?.template?.spec?.containers?.find(
  (container) => container.name === 'k8s-manager-container',
)?.image;
if (manifestImage !== image) {
  console.error(`Expected ${image} in ${manifestPath}. Found ${manifestImage ?? 'no manager image'}.`);
  process.exit(1);
}

function run(command: string[], completed: string) {
  console.log(`> ${command.join(' ')}`);
  const result = Bun.spawnSync(command, { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) process.exit(result.exitCode || 1);
  console.log(completed);
}

const kubectl = ['kubectl', '--context=kind-kind', '-n', 'cloudterm'];
run(['docker', 'build', '-f', 'docker/Dockerfile.k8s-manager', '-t', image, '.'], `Built ${image}.`);
run(['kind', 'load', 'docker-image', image, '--name', 'kind'], `Loaded ${image} into kind.`);
run([...kubectl, 'delete', 'deployment', 'k8s-manager-deployment', '--ignore-not-found'], 'Cleared the previous Deployment.');
run([...kubectl, 'apply', '-f', manifestPath], 'Applied the Deployment in cloudterm.');
