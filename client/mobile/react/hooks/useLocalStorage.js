import { useEffect, useState } from 'react';

export const useLocalStorage = (key, initialValue) => {
	const getItem = () => {
		try {
			const item = localStorage.getItem(key);
			return item ? JSON.parse(item) : initialValue;
		} catch (error) {
			console.error(error);
			return initialValue;
		}
	};

	const [storedValue, setStoredValue] = useState(getItem);

	useEffect(() => {
		try {
			localStorage.setItem(key, JSON.stringify(storedValue));
		} catch (error) {
			console.error(error);
		}
	}, [storedValue]);

	return [storedValue, setStoredValue];
};
