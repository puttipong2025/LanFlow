import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

export const appSwal = MySwal.mixin({
  customClass: {
    confirmButton: 'bg-leaf text-white px-4 py-2 rounded-md font-bold mx-2',
    cancelButton: 'bg-gray-200 text-ink px-4 py-2 rounded-md font-bold mx-2'
  },
  buttonsStyling: false
});

export default appSwal;
