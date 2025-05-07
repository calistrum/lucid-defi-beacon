import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router"; // Commented out the router import
import App from "./App";
import { lazy } from "solid-js";

const User = lazy(() => import("./pages/User"));
const ContractPage = lazy(() => import("./pages/ContractPage")); // Lazy load the ContractPage component


render(() => (
  <Router>
      <Route path="/" component={App} />
      <Route path="/users/:id" component={User} />
      <Route path="/contract/:fingerprint/:action/:quantity" component={ContractPage} />
  </Router>
  //<App />
), document.getElementById("root") as HTMLElement);