import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export const useLocalStorage = <T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] => {
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
