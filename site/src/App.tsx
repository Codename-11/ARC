import NavBar from "./components/NavBar";
import Hero from "./components/Hero";
import Features from "./components/Features";
import FlowDiagram from "./components/FlowDiagram";
import Terminal from "./components/Terminal";
import CTA from "./components/CTA";
import Footer from "./components/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-(--color-black)">
      <NavBar />
      <main>
        <Hero />
        <Features />
        <FlowDiagram />
        <Terminal />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
