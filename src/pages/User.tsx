import { useParams } from "@solidjs/router";

const User = () => {
  const params = useParams(); // Retrieve the dynamic route parameters
  // Now you can access the id parameter as params.id

  return (
    <p>
      This is the user with the id of <code>{params.id}</code>
    </p>
  );
};
export default User;