import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <span className="mark">CT</span>
        <span className="brand">CloudTerm</span>
        <span className="environment">LOCAL / DEVELOPMENT</span>
      </header>
      <section className="hero">
        <p className="eyebrow">Control plane</p>
        <h1>Terminal infrastructure, in one clear view.</h1>
        <p className="lede">The frontend is connected to the CloudTerm service mesh.</p>
        <div className="service-grid">
          {['API Gateway', 'Terminal Gateway', 'K8s Controller'].map((service) => (
            <article className="service" key={service}>
              <span className="status-dot" />
              <div>
                <h2>{service}</h2>
                <p>Operational</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
