import { mount } from './controller';
import { createWorkerClient } from './worker-client';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app');

mount(root, createWorkerClient());
